# Company Ticket System

This repository is created for the ticket sales system for the ODTÜ "Company" Musicals Community.

# Production

First attach a Heroku Postgres to the application on heroku. Then log in to the heroku cli on your terminal. 

```
python manage.py migrate; python manage.py createsuperuser --noinput --username sina --email sinasehlaver@gmail.com; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.get(username='sina'); u.set_password('pass'); u.save()"; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.get(username='sina'); u.set_password('pass'); u.save()"; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.create_user(username='kutuphane', password='pass'); u.save()"; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.create_user(username='carsi', password='pass'); u.save()"; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.create_user(username='hazirlik', password='pass'); u.save()"; python manage.py shell -c "from django.contrib.auth import get_user_model; User = get_user_model(); u = User.objects.create_user(username='baskan', password='pass'); u.is_staff = True; u.save()";

```

## KKM hall creation:

Price scheme:

```
a-f:75,g-k:60,l-z:50
```

## Mimarlık hall creation:

If for example the full capacity is 280 tickets.

Seats:
```
{"count": 280}
```

SeatPlan:
```
{"all": [{"count": 280}]}
```

Price scheme:

```
60
```
