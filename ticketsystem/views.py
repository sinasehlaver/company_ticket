from datetime import datetime
from django.contrib.auth import logout
from django.contrib.auth.decorators import login_required
from django.db.models import Sum, Q
from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import user_passes_test

# Create your views here.
from .forms import EventForm, HallForm
from .models import *


def index(request):
	if not request.user:
		return redirect('login')

	return render(request, 'home/index.html')


def view_404(request, exception=None):
	return redirect('/')


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
def log_index(request):
	days = Day.objects.all().order_by('-date')
	return render(request, 'log/index.html', {'days': days})


@login_required
def get_log(request, day_id):
	day = get_object_or_404(Day, pk=day_id)
	logs = Log.objects.all().filter(day=day).order_by('-datetime')
	days = Day.objects.all().filter(event=day.event).order_by('date')

	return render(request, 'log/detail.html', {'day': day, 'days': days, 'logs': logs})


@login_required
def lookup_log(request, day_id):
	if request.method == 'POST':
		day = get_object_or_404(Day, pk=day_id)
		days = Day.objects.all().filter(event=day.event).order_by('date')
		ticket_str = str(request.POST['ticket']).strip("\r").strip("\n").strip()
		if len(ticket_str.split('-')) == 2:
			print('here')
			row = ticket_str.split('-')[0]
			num = ticket_str.split('-')[1]
			tickets = Ticket.objects.all().filter( day=day, row=row, num=num, event=day.event )
			if len(tickets) > 0:
				logs = Log.objects.all().filter(day=day, ticket=tickets[0]).order_by('-datetime')
				print(logs)
				return render(request, 'log/detail.html', {'day': day, 'days': days, 'logs': logs})

	return redirect('get_log', day_id)


@login_required
def get_event(request, event_id):
	event = get_object_or_404(Event, pk=event_id)
	days = Day.objects.all().filter(event=event)
	return render(request, 'event/detail.html', {'event': event, 'days': days})

@login_required
@user_passes_test(lambda u: u.is_superuser)
def create_hall(request):
	if request.method == 'POST':
		form = HallForm(request.POST)
		if form.is_valid():
			hall = form.save()
			return redirect('get_hall', hall.id)
	else:
		form = HallForm()

	return render(request, 'hall/create.html', {'form': form})


@login_required
@user_passes_test(lambda u: u.is_superuser)
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

	days = Day.objects.all().filter(event=day.event).order_by('date')

	tickets = Ticket.objects.all().filter(event=day.event, day=day)

	free_tickets = Ticket.objects.all().filter(event=day.event, day=day, status=0)

	tickets_count = free_tickets.count()

	reserved_tickets = Ticket.objects.all().filter(event=day.event, day=day, status=1, lastModifiedBy=str(request.user.id))
	reserved_tickets_count = reserved_tickets.count()
	sold_ticket_count = None
	sold_ticket_revenue = None

	if request.user.is_superuser:
		sold_tickets = Ticket.objects.all().filter(event=day.event, day=day, status=2)
		sold_ticket_count = sold_tickets.count()
		sold_ticket_revenue = sold_tickets.aggregate(Sum('price'))['price__sum']

	temp_total = 0
	for ticket in reserved_tickets:
		temp_total += ticket.price

	event = get_object_or_404(Event, pk=day.event.id)
	no_schema = False
	if event.hall.seats.get('count'):
		no_schema = True
	else:
		for ticket in tickets:
			day.tickets_dict[ticket.row][ticket.num] = (ticket.id, ticket.status, ticket.lastModifiedBy)

	# print(day.tickets_dict['z']['10'])

	return render(request, 'day/detail.html',
				{'day': day,
				'days': days,
				'tickets_dict': day.tickets_dict,
				'user_id': str(request.user.id),
				'no_schema': no_schema,
				'tickets_count': tickets_count,
				'reserved_tickets':reserved_tickets,
				'reserved_tickets_count':reserved_tickets_count,
				'temp_total': temp_total,
				'sold_ticket_count': sold_ticket_count,
				'sold_ticket_revenue': sold_ticket_revenue})


@login_required
@user_passes_test(lambda u: u.is_superuser)
def create_day(request, event_id):
	if request.method == "POST":
		event = get_object_or_404(Event, pk=event_id)
		priceSchema = str(request.POST['priceSchema']).strip("\r").strip("\n").strip(" ").strip()
		date_str = request.POST['date']
		seats = event.hall.seats

		if seats.get('count'):
			day = Day(
				date=datetime.strptime(date_str, '%Y-%m-%dT%H:%M'),
				event=event,
				tickets_dict={}
			)
			day.save()
			for i in range(seats['count']):
				ticket = Ticket(
					row='m',
					num=i,
					day=day,
					event=event,
					price=priceSchema,
					category=0
				)
				ticket.save()
		else:
			categories = priceSchema.split(",")
			prices = {}
			i = 0
			for cat in categories:
				if len(cat.strip().split(':')) == 2:
					cat_range = cat.strip().split(':')[0]
					if len(cat_range.split('-')) == 2:
						cat_range_s = cat_range.split('-')[0].lower()
						cat_range_e = cat_range.split('-')[1].lower()
						cat_price = int(cat.split(':')[1])
						i += 1
						for char_int in range(ord(cat_range_s), ord(cat_range_e) + 1):
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
						if prices.get(ord(row)):
							price = prices[ord(row)][0]
							cat = prices[ord(row)][1]
							tickets_dict[row]['-1'] = (price, int(210*((i-cat-1)/(i-1))) + 150 )
							for num in row_dict[row]:
								if num != "-1":
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

	return render(request, 'day/create.html', {'event_id': event_id})


@login_required
def reserve_toggle(request, day_id, ticket_id):
	day = get_object_or_404(Day, pk=day_id)
	ticket = get_object_or_404(Ticket, pk=ticket_id)
	if ticket.status == 0:
		ticket.status = 1
		ticket.lastModifiedBy = str(request.user.id)
	elif ticket.status == 1 and ticket.lastModifiedBy == str(request.user.id):
		print('here')
		ticket.status = 0

	if ticket.status != 2:
		ticket.save()
	return redirect('get_day', day_id)

@login_required
def reserve(request, day_id):
	day = get_object_or_404(Day, pk=day_id)
	tickets = Ticket.objects.all().filter(event=day.event, day=day, status=0)
	if tickets:
		ticket = tickets[0]
		ticket.status = 1
		ticket.lastModifiedBy = str(request.user.id)
		ticket.save()

	return redirect('get_day', day_id)

@login_required
def dereserve(request, day_id):
	day = get_object_or_404(Day, pk=day_id)
	tickets = Ticket.objects.all().filter(event=day.event, day=day, status=1, lastModifiedBy=str(request.user.id))
	if tickets:
		ticket = tickets[0]
		ticket.status = 0
		ticket.lastModifiedBy = str(request.user.id)
		ticket.save()

	return redirect('get_day', day_id)

@login_required
def sell(request, day_id):
	day = get_object_or_404(Day, pk=day_id)
	tickets = Ticket.objects.all().filter(event=day.event, day=day, status=1, lastModifiedBy=str(request.user.id))

	for ticket in tickets:
		ticket.status = 2
		ticket.save()
		log = Log(
			ticket=ticket,
			action="satış",
			day=day,
			user=str(request.user.username)
		)
		log.save()

	return redirect('get_day', day_id)


@login_required
def cancel(request, day_id):
	if request.method == "POST":
		day = get_object_or_404(Day, pk=day_id)
		tickets_str = str(request.POST['tickets']).strip("\r").strip("\n").strip(" ")
		tickets_str_list = tickets_str.split(',')
		for ticket_str in tickets_str_list:
			row = ticket_str.split('-')[0]
			num = ticket_str.split('-')[1]
			tickets = Ticket.objects.all().filter(event=day.event,
												day=day,
												status=2,
												row=row,
												num=num)
			if tickets:
				tickets[0].status = 0
				tickets[0].save()
				log = Log(
					ticket=tickets[0],
					action="satış iptal",
					day=day,
					user=str(request.user.username)
				)
				log.save()

	return redirect('get_day', day_id)

@login_required
def cancel_count(request, day_id):
	if request.method == "POST":
		day = get_object_or_404(Day, pk=day_id)
		tickets_str = str(request.POST['tickets']).strip("\r").strip("\n").strip(" ")

		tickets = Ticket.objects.all().filter(event=day.event,
											  day=day,
											  status=2)

		for ticket in tickets[:int(tickets_str)]:
			ticket.status = 0
			ticket.save()
			log = Log(
				ticket=ticket,
				action="satış iptal",
				day=day,
				user=str(request.user.username)
			)
			log.save()

	return redirect('get_day', day_id)
