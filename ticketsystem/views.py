import json
from datetime import datetime

from django.http import HttpResponse
from django.shortcuts import render, get_object_or_404, redirect

# Create your views here.
from .forms import EventForm
from .models import *


def index(request):
	return render(request, 'home/index.html')


def hall_index(request):
	halls = Hall.objects.all()
	return render(request, 'hall/index.html', {'halls': halls})


def get_hall(request, hall_id):
	hall = get_object_or_404(Hall, pk=hall_id)
	return render(request, 'hall/detail.html', {'hall': hall})


def event_index(request):
	events = Event.objects.all()
	return render(request, 'event/index.html', {'events': events})


def get_event(request, event_id):
	event = get_object_or_404(Event, pk=event_id)
	return render(request, 'event/detail.html', {'event': event})


def create_event(request):
	if request.method == 'POST':
		form = EventForm(request.POST)
		if form.is_valid():
			event = form.save()
			return redirect('get_event', event.id)
	else:
		form = EventForm()

	return render(request, 'event/create.html', {'form': form})

def create_day(request, event_id):

	if request.method == "POST":
		event = get_object_or_404(Event, pk=event_id)
		priceSchema = str(request.POST['priceSchema']).strip("\r").strip("\n").strip(" ")
		date_str = request.POST['date']
		date = datetime.strptime(date_str,'%Y-%m-%dT%H:%M' )
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

		for row_dict in seats['all']:
			for row in row_dict:
				if row != "-":
					price = prices[ord(row)][0]
					cat = prices[ord(row)][1]
					for num in row_dict[row]:
						if num != -1:
							ticket = Ticket(
								row=row,
								num=num,
								date=date,
								event=event,
								price=price,
								category=cat
							)
							ticket.save()

		return redirect('get_event', event.id)

	return render(request, 'day/create.html')
