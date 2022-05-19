import json
from datetime import datetime
import copy

from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.http import HttpResponse
from django.shortcuts import render, get_object_or_404, redirect

# Create your views here.
from .forms import EventForm
from .models import *


def index(request):

	if not request.user:
		return redirect('login')

	return render(request, 'home/index.html')


@login_required
def logout_view(request):
	logout(request)
	return redirect('index')


@login_required
def hall_index(request):
	halls = Hall.objects.all()
	return render(request, 'hall/index.html', {'halls': halls})


@login_required
def get_hall(request, hall_id):
	hall = get_object_or_404(Hall, pk=hall_id)
	return render(request, 'hall/detail.html', {'hall': hall})


@login_required
def event_index(request):
	events = Event.objects.all()
	return render(request, 'event/index.html', {'events': events})


@login_required
def get_event(request, event_id):
	event = get_object_or_404(Event, pk=event_id)
	days = Day.objects.all().filter(event=event)
	return render(request, 'event/detail.html', {'event': event, 'days': days})


@login_required
def create_event(request):
	if request.method == 'POST':
		form = EventForm(request.POST)
		if form.is_valid():
			event = form.save()
			return redirect('get_event', event.id)
	else:
		form = EventForm()

	return render(request, 'event/create.html', {'form': form})


@login_required
def get_day(request, day_id):
	day = get_object_or_404(Day, pk=day_id)

	days = Day.objects.all().filter(event=day.event).order_by('-date')

	tickets = Ticket.objects.all().filter(event=day.event, day=day)

	for ticket in tickets:
		day.tickets_dict[ticket.row][ticket.num] = (ticket.id, ticket.status, ticket.lastModifiedBy)

	#print(day.tickets_dict['z']['10'])

	return render(request, 'day/detail.html', {'day': day, 'days': days,'tickets_dict': day.tickets_dict, 'user_id': str(request.user.id)})


@login_required
def create_day(request, event_id):

	if request.method == "POST":
		event = get_object_or_404(Event, pk=event_id)
		priceSchema = str(request.POST['priceSchema']).strip("\r").strip("\n").strip(" ")
		date_str = request.POST['date']

		seats = event.hall.seats
		categories = priceSchema.split(",")
		print(categories)
		prices = {}
		for i,cat in enumerate(categories):
			cat_range = cat.split(':')[0]
			cat_range_s = cat_range.split('-')[0].lower()
			cat_range_e = cat_range.split('-')[1].lower()
			cat_price = int(cat.split(':')[1])
			for char_int in range(ord(cat_range_s), ord(cat_range_e)+1):
				prices[char_int] = (cat_price, i)

		day = Day(
			date=datetime.strptime(date_str, '%Y-%m-%dT%H:%M'),
			event=event,
			tickets_dict={}
		)
		day.save()
		tickets_dict = {}
		for row_dict in seats['all']:
			for row in row_dict:
				if row != "-":
					tickets_dict[row] = {}
					price = prices[ord(row)][0]
					cat = prices[ord(row)][1]
					for num in row_dict[row]:
						if num != -1:
							ticket = Ticket(
								row=row,
								num=num,
								day=day,
								event=event,
								price=price,
								category=cat
							)
							ticket.save()
							tickets_dict[row][num] = (ticket.id, ticket.status, ticket.lastModifiedBy)

		day.tickets_dict = tickets_dict
		day.save()

		return redirect('get_day', day.id)

	return render(request, 'day/create.html')


@login_required
def reserve_toggle(request, day_id, ticket_id):
	ticket = get_object_or_404(Ticket, pk=ticket_id)
	print(ticket)
	print(ticket.lastModifiedBy == str(request.user.id))
	if ticket.status == 0:
		ticket.status = 1
		ticket.lastModifiedBy = str(request.user.id)
	elif ticket.status == 1 and ticket.lastModifiedBy == str(request.user.id):
		print('here')
		ticket.status = 0

	if ticket.status != 2:
		ticket.save()

	print(ticket)
	return redirect('get_day', day_id)

@login_required
def sell(request, day_id):
	day = get_object_or_404(Day, pk=day_id)
	tickets = Ticket.objects.all().filter(event=day.event, day=day, status=1, lastModifiedBy=str(request.user.id))

	for ticket in tickets:
		ticket.status = 2
		ticket.save()

	return redirect('get_day', day_id)
